#!/usr/bin/env osascript -l JavaScript
// Render text strings to transparent PNGs with proper Thai shaping (CoreText).
// Usage: osascript -l JavaScript render-text.js '<json-spec-path>'
// Spec: {"items":[{"text":"...","font":"Thonburi-Bold","size":92,"color":[255,255,255],"out":"/tmp/x.png"}]}
ObjC.import("Cocoa");

function run(argv) {
  const specPath = argv[0];
  const jsSpec = JSON.parse(
    ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(specPath, $.NSUTF8StringEncoding, null))
  );

  jsSpec.items.forEach((it) => {
    const font = $.NSFont.fontWithNameSize(it.font, it.size);
    const color = $.NSColor.colorWithSRGBRedGreenBlueAlpha(
      it.color[0] / 255, it.color[1] / 255, it.color[2] / 255, 1
    );
    const attrs = $.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey(font, $.NSFontAttributeName);
    attrs.setObjectForKey(color, $.NSForegroundColorAttributeName);
    const str = $(it.text);

    const sz = str.sizeWithAttributes(attrs);
    const w = Math.ceil(sz.width) + 12;
    const h = Math.ceil(sz.height) + 12;

    // Exact-pixel bitmap (no retina scaling surprises)
    const rep = $.NSBitmapImageRep.alloc
      .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
        null, w, h, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0
      );
    const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext(ctx);
    str.drawAtPointWithAttributes($.NSMakePoint(6, 6), attrs);
    ctx.flushGraphics;
    $.NSGraphicsContext.restoreGraphicsState;

    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);
    png.writeToFileAtomically(it.out, true);
  });
  return "ok";
}
