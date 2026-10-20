/* Shared, retryable assets for invoice and staff PDFs. */
var PdfAssets = (() => {
    const libraryPromises = new Map();
    let fontsPromise;

    async function loadFonts() {
        if (!fontsPromise) fontsPromise = Promise.all(['NotoSansGeorgian-Regular.ttf','NotoSansGeorgian-Bold.ttf','chao-logo.png'].map(async filename=>{
            const response = await fetch(`assets/${filename}`);
            if (!response.ok) throw new Error('Font download failed');
            const bytes = new Uint8Array(await response.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
        })).then(([normal,bold,logo])=>({normal,bold,logo:`data:image/png;base64,${logo}`})).catch(error=>{fontsPromise=null;throw error;});
        return fontsPromise;
    }

    function loadLibrary(source, ready) {
        if (ready()) return Promise.resolve();
        if (!libraryPromises.has(source)) {
            const script = document.createElement('script');
            script.src = source;
            const promise = new Promise((resolve, reject) => {
                script.onload = () => ready() ? resolve() : reject(new Error('PDF library unavailable'));
                script.onerror = () => reject(new Error('PDF library download failed'));
                document.head.append(script);
            }).catch(error => {
                libraryPromises.delete(source); script.remove(); throw error;
            });
            libraryPromises.set(source, promise);
        }
        return libraryPromises.get(source);
    }

    async function loadLibraries() {
        await loadLibrary('vendor/jspdf.umd.min.js?v=4.2.1', () => !!window.jspdf?.jsPDF);
        await loadLibrary('vendor/jspdf.plugin.autotable.min.js?v=5.0.9', () => typeof window.autoTable === 'function');
    }

    async function load() {
        const [, fonts] = await Promise.all([loadLibraries(), loadFonts()]);
        return fonts;
    }
    return {load};
})();
