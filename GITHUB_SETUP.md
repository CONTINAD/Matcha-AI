# GitHub Setup Guide

## Quick Setup (Recommended)

Run the automated setup script:

```bash
./setup-github.sh
```

This will:
1. Set up your git config (if needed)
2. Authenticate with GitHub (opens browser)
3. Create the repository
4. Push your code

## Manual Setup (If script fails)

### 1. Set Git Config

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 2. Authenticate with GitHub CLI

**Option A: Web Browser (Interactive)**
```bash
gh auth login --web
```

**Option B: Personal Access Token (Non-interactive)**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select `repo` scope
4. Copy the token
5. Run:
```bash
echo "YOUR_TOKEN_HERE" | gh auth login --with-token
```

### 3. Create Repository and Push

```bash
# Create repo
gh repo create matcha-ai --public \
  --description "AI-driven crypto trading system with Solana support" \
  --source=. \
  --remote=origin

# Push code
git branch -M main
git push -u origin main
```

## Troubleshooting

### "Authentication Failed"
- Make sure you're logged in: `gh auth status`
- Re-authenticate: `gh auth login --web`

### "Repository already exists"
- The script will automatically use the existing repo
- Or delete it first: `gh repo delete matcha-ai --yes`

### "Permission denied (publickey)"
- Set up SSH keys: `gh auth login --web --git-protocol ssh`
- Or use HTTPS: `gh auth login --web --git-protocol https`

