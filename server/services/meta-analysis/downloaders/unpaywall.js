import fetch from 'node-fetch';

function normalizeDoi(doi) {
  return String(doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim().toLowerCase();
}

export async function downloadFromUnpaywall(reference = {}) {
  const doi = normalizeDoi(reference.doi || reference.raw_data?.doi);
  if (!doi) {
    return { status: 'unavailable', source: 'unpaywall', error: 'No DOI available' };
  }

  const email = process.env.UNPAYWALL_EMAIL;
  if (!email) {
    return { status: 'unavailable', source: 'unpaywall', error: 'UNPAYWALL_EMAIL is not configured' };
  }

  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  const payload = await fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Unpaywall request failed (${response.status})`);
    }
    return response.json();
  });

  const pdfUrl = payload?.is_oa ? payload?.best_oa_location?.pdf_url : null;
  if (!pdfUrl) {
    return {
      status: payload?.is_oa ? 'institution_login_required' : 'manual_upload_required',
      source: 'unpaywall',
      error: payload?.is_oa ? 'Open landing page found, but no legal PDF URL was supplied' : 'Record is not open access',
    };
  }

  const response = await fetch(pdfUrl, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('pdf')) {
    return { status: 'unavailable', source: 'unpaywall', error: 'Unpaywall PDF URL did not return a PDF' };
  }

  return {
    status: 'downloaded',
    source: 'unpaywall',
    licenseStatus: 'open_access',
    pdfBuffer: Buffer.from(await response.arrayBuffer()),
    url: pdfUrl,
  };
}
