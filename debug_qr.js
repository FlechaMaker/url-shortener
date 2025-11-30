import QRCode from 'qrcode';

async function testQR() {
  const text = 'example.com/abcdef';
  
  try {
    // Test SVG generation
    const qrSvg = await QRCode.toString(text, {
      type: 'svg',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    console.log('--- Original SVG ---');
    console.log(qrSvg.substring(0, 100) + '...');

    // Test Regex Logic
    const qrSvgContent = qrSvg.replace(/<\?xml[^>]*\?>/, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>/, "");
    console.log('--- Extracted Content ---');
    console.log(qrSvgContent.substring(0, 100) + '...');

    // Test Data URL (likely fails in Node without Canvas, but let's see)
    try {
        const dataUrl = await QRCode.toDataURL(text);
        console.log('Data URL generated successfully (unexpected in pure Node without Canvas)');
    } catch (e) {
        console.log('Data URL generation failed as expected:', e.message);
    }

  } catch (e) {
    console.error(e);
  }
}

testQR();
