#!/bin/bash

# Script to push Matcha AI to GitHub
# Run this after authenticating with GitHub CLI

echo "🚀 Pushing Matcha AI to GitHub..."

# Check if authenticated
if ! gh auth status &>/dev/null; then
    echo "❌ Not authenticated with GitHub CLI"
    echo "📝 Run: gh auth login"
    exit 1
fi

# Create repository (if it doesn't exist)
REPO_NAME="matcha-ai"
echo "📦 Creating GitHub repository: $REPO_NAME"
gh repo create "$REPO_NAME" --public --description "AI-driven crypto trading system with Solana support" --source=. --remote=origin --push || {
    echo "⚠️  Repository might already exist, continuing..."
}

# Add remote if it doesn't exist
if ! git remote get-url origin &>/dev/null; then
    GITHUB_USER=$(gh api user --jq .login)
    echo "🔗 Adding remote: git@github.com:$GITHUB_USER/$REPO_NAME.git"
    git remote add origin "git@github.com:$GITHUB_USER/$REPO_NAME.git" || {
        echo "⚠️  Remote might already exist, continuing..."
    }
fi

# Push to GitHub
echo "📤 Pushing to GitHub..."
git branch -M main
git push -u origin main

echo "✅ Done! Repository: https://github.com/$GITHUB_USER/$REPO_NAME"

