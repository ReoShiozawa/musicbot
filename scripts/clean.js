const { rm } = require('fs/promises');
const { join } = require('path');

async function cleanDirectories() {
    const dirs = ['node_modules', 'dist'];
    const root = process.cwd();

    for (const dir of dirs) {
        try {
            await rm(join(root, dir), { recursive: true, force: true });
            console.log(`Successfully removed ${dir}`);
        } catch (error) {
            console.error(`Error removing ${dir}:`, error);
        }
    }
}

cleanDirectories().catch(console.error);
