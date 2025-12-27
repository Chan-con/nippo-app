const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const TARGET_SIZE = 256;

function resizeNearestNeighbor(srcPng, targetWidth, targetHeight) {
	const dst = new PNG({ width: targetWidth, height: targetHeight });
	const srcWidth = srcPng.width;
	const srcHeight = srcPng.height;

	for (let y = 0; y < targetHeight; y++) {
		const srcY = Math.floor((y * srcHeight) / targetHeight);
		for (let x = 0; x < targetWidth; x++) {
			const srcX = Math.floor((x * srcWidth) / targetWidth);

			const srcIdx = (srcWidth * srcY + srcX) << 2;
			const dstIdx = (targetWidth * y + x) << 2;

			dst.data[dstIdx] = srcPng.data[srcIdx];
			dst.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
			dst.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
			dst.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
		}
	}

	return dst;
}

function main() {
	if (!fs.existsSync(ICON_PATH)) {
		console.error(`Icon not found: ${ICON_PATH}`);
		process.exit(1);
	}

	const input = fs.readFileSync(ICON_PATH);
	const png = PNG.sync.read(input);

	if (png.width >= TARGET_SIZE && png.height >= TARGET_SIZE) {
		console.log(`Icon OK: ${png.width}x${png.height}`);
		return;
	}

	const resized = resizeNearestNeighbor(png, TARGET_SIZE, TARGET_SIZE);
	fs.writeFileSync(ICON_PATH, PNG.sync.write(resized));
	console.log(`Icon updated: ${png.width}x${png.height} -> ${TARGET_SIZE}x${TARGET_SIZE} (${path.relative(process.cwd(), ICON_PATH)})`);
}

main();
