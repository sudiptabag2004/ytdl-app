#!/usr/bin/env bash

# YTDown - Secure Global Access Tunnel
# This script creates a secure, public HTTPS link directly to your Mac.

echo "╔════════════════════════════════════╗"
echo "║      YTDown - Global Access        ║"
echo "╚════════════════════════════════════╝"
echo ""

# Check if Cloudflare's tunneling client is installed
if ! command -v cloudflared &> /dev/null; then
    echo "📦 'cloudflared' not found. Installing via Homebrew..."
    if ! command -v brew &> /dev/null; then
        echo "❌ Error: Homebrew is required to install cloudflared."
        echo "Please install Homebrew from https://brew.sh first."
        exit 1
    fi
    brew install cloudflared
    echo "✅ Installation complete."
    echo ""
fi

echo "🌐 Booting up secure Cloudflare network tunnel..."
echo "⚠️  Look for the link that ends in '.trycloudflare.com' below!"
echo "   (It will take a few seconds to appear)"
echo ""
echo "Press CTRL+C at any time to close the tunnel."
echo "--------------------------------------------------------"

# Run Cloudflared targeting the local app on port 5011
cloudflared tunnel --url http://localhost:5011
