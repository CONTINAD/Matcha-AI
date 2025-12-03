#!/bin/bash

# Simple GitHub connection script
set -e

echo "🔗 Connecting to GitHub..."
echo ""

# Step 1: Get token from user
echo "📝 Step 1: Get a GitHub Personal Access Token"
echo ""
echo "1. Open: https://github.com/settings/tokens/new"
echo "2. Name it: 'Matcha AI'"
echo "3. Select scope: ✅ repo (all repo permissions)"
echo "4. Click 'Generate token'"
echo "5. Copy the token (you won't see it again!)"
echo ""
read -sp "Paste your token here and press Enter: " GITHUB_TOKEN
echo ""
echo ""

# Step 2: Authenticate
echo "🔐 Step 2: Authenticating..."
echo "$GITHUB_TOKEN" | gh auth login --with-token

# Step 3: Verify
echo ""
echo "✅ Step 3: Verifying connection..."
GITHUB_USER=$(gh api user --jq .login)
echo "Connected as: $GITHUB_USER"
echo ""

# Step 4: Create repo and push
echo "📦 Step 4: Creating repository..."
REPO_NAME="matcha-ai"

# Check if repo exists
if gh repo view "$GITHUB_USER/$REPO_NAME" &>/dev/null; then
    echo "Repository already exists, using it..."
    git remote remove origin 2>/dev/null || true
    git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
else
    echo "Creating new repository..."
    gh repo create "$REPO_NAME" --public \
        --description "AI-driven crypto trading system with Solana support" \
        --source=. \
        --remote=origin || {
        echo "Setting up remote manually..."
        git remote remove origin 2>/dev/null || true
        git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"
    }
fi

# Step 5: Push
echo ""
echo "📤 Step 5: Pushing code..."
git branch -M main 2>/dev/null || true
git push -u origin main

echo ""
echo "🎉 SUCCESS!"
echo "🌐 Your repository: https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""

