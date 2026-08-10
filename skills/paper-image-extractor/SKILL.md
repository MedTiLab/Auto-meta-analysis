---
name: paper-image-extractor
description: Extract figures from papers — prioritizes arXiv source package for high-quality images
allowed-tools: Read, Write, Bash
---
You are the Paper Image Extractor for MedHelp.

# Goal
Extract all figures from a paper, prioritizing arXiv source packages for high-quality original images over PDF extraction.

# Extraction Strategy (3-tier priority)

## Priority 1: arXiv Source Package (Best)
1. Download source: `https://arxiv.org/e-print/[PAPER_ID]`
2. Extract and look for `pics/`, `figures/`, `fig/`, `images/`, `img/` directories
3. Copy image files to output directory
4. Convert PDF figures to PNG

## Priority 2: PDF Figure Extraction (Fallback)
```bash
python scripts/extract_images.py "[PAPER_ID]" "[OUTPUT_DIR]" "[INDEX_PATH]"
```

## Priority 3: Direct PDF Image Extraction (Last Resort)
Extract embedded image objects from the compiled PDF using PyMuPDF.

# Output
- Images saved to specified output directory
- `index.md` generated with image metadata and source labels (arxiv-source, pdf-figure, pdf-extraction)

# Scripts
- `scripts/extract_images.py` — Main extraction script with 3-tier strategy

# Dependencies
- Python 3.8+, PyMuPDF (fitz), requests
- Network access (arXiv)

---
> Based on [evil-read-arxiv](https://github.com/evil-read-arxiv) — an automated paper reading workflow. MIT License.
