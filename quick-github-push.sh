#!/bin/bash

# Quick GitHub push - checks status and pushes if ready
set -e

cd "$(dirname "$0")"

echo "🔍 Checking GitHub setup..."

# Check git config
if [ -z "$(git config user.name)" ]; then
    echo "❌ Git user.name not set"
    echo "Run: git config --global user.name 'Your Name'"
    exit 1
fi

if [ -z "$(git config user.email)" ]; then
    echo "❌ Git user.email not set"
    echo "Run: git config --global user.email 'your@email.com'"
    exit 1
fi

# Check GitHub auth
if ! gh auth status &>/dev/null; then
    echo "❌ Not authenticated with GitHub"
    echo ""
    echo "Quick fix - use token method:"
    echo "1. Go to: https://github.com/settings/tokens"
    echo "2. Generate token with 'repo' scope"
    echo "3. Run: echo 'YOUR_TOKEN' | gh auth login --with-token"
    exit 1
fi

# Get GitHub username
GITHUB_USER=$(gh api user --jq .login)
REPO_NAME="matcha-ai"

echo "✅ Authenticated as: $GITHUB_USER"

# Check if remote exists
if git remote get-url origin &>/dev/null; then
    echo "✅ Remote 'origin' already configured"
else
    echo "🔗 Adding remote..."
    git remote add origin "git@github.com:$GITHUB_USER/$REPO_NAME.git" || {
        git remote set-url origin "git@github.com:$GITHUB_USER/$REPO_NAME.git"
    }
fi

# Check if repo exists, create if not
if ! gh repo view "$GITHUB_USER/$REPO_NAME" &>/dev/null; then
    echo "📦 Creating repository..."
    gh repo create "$REPO_NAME" --public \
        --description "AI-driven crypto trading system with Solana support" \
        --source=. \
        --remote=origin || true
fi

# Ensure main branch
git branch -M main 2>/dev/null || true

# Push
echo "📤 Pushing to GitHub..."
git push -u origin main || {
    echo "⚠️  Push failed. Trying to set upstream..."
    git push --set-upstream origin main
}

echo ""
echo "✅ Success! Repository: https://github.com/$GITHUB_USER/$REPO_NAME"

