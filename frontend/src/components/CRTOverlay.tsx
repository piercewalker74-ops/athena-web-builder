// CRTOverlay — scanlines, vignette, chromatic aberration live in CSS.
// This component renders the hidden SVG filter definition that the root
// element references for the periodic chromatic aberration glitch.

export function CRTOverlay() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
    >
      <defs>
        {/* Full-page chromatic aberration filter — applied via CSS `filter: url(#crt-ca)` */}
        <filter id="crt-ca" x="-3%" y="-3%" width="106%" height="106%" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="r"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0"
            result="g"
          />
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0"
            result="b"
          />
          <feOffset dx="-1.5" dy="0" in="r" result="r-off" />
          <feOffset dx="1.5"  dy="0" in="b" result="b-off" />
          <feMerge>
            <feMergeNode in="r-off" />
            <feMergeNode in="g"     />
            <feMergeNode in="b-off" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
