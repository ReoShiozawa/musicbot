#!/bin/bash

echo "Installing dependencies..."

# Check if running on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Install yt-dlp using Homebrew
    brew install yt-dlp ffmpeg opus
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Install yt-dlp on Linux
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
    sudo apt-get update && sudo apt-get install -y ffmpeg opus-tools
fi

# Clean install
rm -rf node_modules package-lock.json
npm cache clean --force

# Install Node.js dependencies
npm install

echo "Setup complete!"
