import fetch from 'node-fetch';

function firstIdentifier(reference = {}) {
  return reference.pmcid || reference.raw_data?.pmcid || reference.source_id || reference.pmid || reference.doi || null;
}

function isOfficialOpenHtmlUrl(item = {}) {
  const style = String(item.documentStyle || '').toLowerCase();
  const availability = String(item.availability || '').toLowerCase();
  if (style !== 'html' || !availability.includes('open') || !item.url) return false;
  try {
    const hostname = new URL(item.url).hostname.toLowerCase();
    return hostname === 'europepmc.org'
      || hostname.endsWith('.europepmc.org')
      || hostname === 'www.ebi.ac.uk'
      || hostname.endsWith('.ebi.ac.uk')
      || hostname === 'www.ncbi.nlm.nih.gov'
      || hostname.endsWith('.ncbi.nlm.nih.gov');
  } catch {
    return false;
  }
}

async function lookupEuropePmc(reference = {}) {
  const identifier = firstIdentifier(reference);
  if (!identifier) {
    return { error: 'No PMID, PMCID, or DOI available' };
  }

  const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
  url.searchParams.set('query', String(identifier));
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageSize', '1');

  const payload = await fetch(url.toString()).then((response) => {
    if (!response.ok) {
      throw new Error(`Europe PMC request failed (${response.status})`);
    }
    return response.json();
  });

  return { result: payload?.resultList?.result?.[0] || null };
}

export async function downloadFromEuropePmc(reference = {}) {
  const { result, error } = await lookupEuropePmc(reference);
  if (error) {
    return { status: 'unavailable', source: 'europe_pmc', error: 'No PMID, PMCID, or DOI available' };
  }
  const urls = result?.fullTextUrlList?.fullTextUrl || [];
  const pdf = urls.find((item) => {
    const style = String(item.documentStyle || '').toLowerCase();
    const availability = String(item.availability || '').toLowerCase();
    return style === 'pdf' && availability.includes('open');
  });

  if (!pdf?.url) {
    return { status: 'unavailable', source: 'europe_pmc', error: 'No open-access Europe PMC PDF URL found' };
  }

  const response = await fetch(pdf.url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('pdf')) {
    return { status: 'unavailable', source: 'europe_pmc', error: 'Europe PMC PDF URL did not return a PDF' };
  }

  return {
    status: 'downloaded',
    source: 'europe_pmc',
    licenseStatus: 'open_access',
    pdfBuffer: Buffer.from(await response.arrayBuffer()),
    url: pdf.url,
  };
}

export async function downloadHtmlFromEuropePmc(reference = {}) {
  const { result, error } = await lookupEuropePmc(reference);
  if (error) {
    return { status: 'unavailable', source: 'europe_pmc_html', error };
  }
  if (String(result?.isOpenAccess || '').toUpperCase() !== 'Y') {
    return { status: 'unavailable', source: 'europe_pmc_html', error: 'Europe PMC record is not marked open access' };
  }

  const urls = result?.fullTextUrlList?.fullTextUrl || [];
  const html = urls.find(isOfficialOpenHtmlUrl);
  const url = html?.url || (result?.pmcid ? `https://europepmc.org/articles/${encodeURIComponent(result.pmcid)}` : '');
  if (!url) {
    return { status: 'unavailable', source: 'europe_pmc_html', error: 'No official open Europe PMC HTML URL found' };
  }

  const response = await fetch(url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('html')) {
    return { status: 'unavailable', source: 'europe_pmc_html', error: 'Europe PMC HTML URL did not return HTML' };
  }

  return {
    status: 'downloaded',
    source: 'europe_pmc_html',
    licenseStatus: 'open_access',
    assetType: 'html',
    contentType: contentType.split(';')[0] || 'text/html',
    assetBuffer: Buffer.from(await response.arrayBuffer()),
    url,
  };
}
