import fetch from 'node-fetch';

function getNormalizedPmcid(reference = {}) {
  const pmcid = reference.pmcid || reference.pmc_id || reference.raw_data?.pmcid || reference.raw_data?.pmcId;
  if (!pmcid) {
    return '';
  }
  return String(pmcid).startsWith('PMC') ? String(pmcid) : `PMC${pmcid}`;
}

export async function downloadFromPmc(reference = {}) {
  const normalizedPmcid = getNormalizedPmcid(reference);
  if (!normalizedPmcid) {
    return { status: 'unavailable', source: 'pmc', error: 'No PMCID available' };
  }
  const url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(normalizedPmcid)}/pdf/`;
  const response = await fetch(url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('pdf')) {
    return { status: 'unavailable', source: 'pmc', error: 'PMC PDF not available' };
  }

  return {
    status: 'downloaded',
    source: 'pmc',
    licenseStatus: 'open_access',
    pdfBuffer: Buffer.from(await response.arrayBuffer()),
    url,
  };
}

export async function downloadHtmlFromPmc(reference = {}) {
  const normalizedPmcid = getNormalizedPmcid(reference);
  if (!normalizedPmcid) {
    return { status: 'unavailable', source: 'pmc_html', error: 'No PMCID available' };
  }

  const url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${encodeURIComponent(normalizedPmcid)}/`;
  const response = await fetch(url, { redirect: 'follow' });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.toLowerCase().includes('html')) {
    return { status: 'unavailable', source: 'pmc_html', error: 'PMC HTML full text not available' };
  }

  return {
    status: 'downloaded',
    source: 'pmc_html',
    licenseStatus: 'open_access',
    assetType: 'html',
    contentType: contentType.split(';')[0] || 'text/html',
    assetBuffer: Buffer.from(await response.arrayBuffer()),
    url,
  };
}
