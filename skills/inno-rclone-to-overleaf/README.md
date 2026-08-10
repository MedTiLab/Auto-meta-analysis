# Overleaf sync skill

AI-assisted Overleaf integration for syncing LaTeX projects with MedHelp (or any agent that loads skills from this repo).

## Features

- 📄 Read/write LaTeX files directly from Overleaf
- 🔄 Sync local .tex files with Overleaf projects
- 📦 Download entire projects as zip
- 🔐 Authenticate via browser cookies (no API key needed)

## Installation

```bash
# Add this skill to your project’s skills directory (or your agent’s skill path), then:

# Install pyoverleaf CLI
pipx install pyoverleaf
```

## Requirements

- Python 3.8+
- Logged into Overleaf in Chrome/Firefox
- macOS: Grant keychain access on first run

## Example

Here's an example of using the skill to remove em dashes (a common AI writing artifact) from a paper and push the changes to Overleaf:

![Example: Remove em dashes and push to Overleaf](example-em-dash.jpg)

## Usage

See [SKILL.md](SKILL.md) for detailed usage instructions.

## Links

- [pyoverleaf GitHub](https://github.com/jkulhanek/pyoverleaf)
