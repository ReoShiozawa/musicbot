const { execSync } = require('child_process');
const os = require('os');

console.log('Installing system dependencies...');

try {
    if (os.platform() === 'darwin') {  // macOS
        execSync('brew install ffmpeg || true');
        execSync('brew install opus || true');
        execSync('brew install python || true');
        execSync('brew install pkg-config || true');
    } else if (os.platform() === 'linux') {  // Linux
        execSync('sudo apt-get update');
        execSync('sudo apt-get install -y ffmpeg opus-tools python3 pkg-config');
    }
    console.log('System dependencies installed successfully!');
} catch (error) {
    console.error('Error installing dependencies:', error);
    process.exit(1);
}
