// OpenCV Functions (Card Detection & Perspective Correction)

let cvLoadPromise = null;

function loadOpenCV() {
    if (cvLoadPromise) return cvLoadPromise;
    
    setStatus('cv', 'loading');
    
    cvLoadPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn('⚠️ OpenCV timeout');
            setStatus('cv', 'error');
            resolve(false);
        }, 8000);
        
        const check = setInterval(() => {
            if (typeof cv !== 'undefined' && cv.Mat) {
                clearInterval(check);
                clearTimeout(timeout);
                ready.cv = true;
                setStatus('cv', 'ready');
                console.log('✅ OpenCV ready');
                resolve(true);
            }
        }, 100);
    });
    
    return cvLoadPromise;
}

async function detectCard(imageUrl) {
    if (!ready.cv || !config.autoDetect) return imageUrl;
    
    try {
        return await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    
                    const src = cv.imread(canvas);
                    const gray = new cv.Mat();
                    const blurred = new cv.Mat();
                    const edges = new cv.Mat();
                    const contours = new cv.MatVector();
                    const hierarchy = new cv.Mat();
                    
                    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
                    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
                    cv.Canny(blurred, edges, 50, 150);
                    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
                    
                    let maxArea = 0;
                    let bestContour = null;
                    
                    for (let i = 0; i < contours.size(); i++) {
                        const contour = contours.get(i);
                        const area = cv.contourArea(contour);
                        const perimeter = cv.arcLength(contour, true);
                        const approx = new cv.Mat();
                        
                        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
                        
                        if (approx.rows === 4 && area > maxArea) {
                            maxArea = area;
                            if (bestContour) bestContour.delete();
                            bestContour = approx.clone();
                        }
                        
                        approx.delete();
                        contour.delete();
                    }
                    
                    let result = canvas.toDataURL('image/jpeg', config.quality);
                    
                    if (bestContour && config.perspective) {
                        result = applyPerspective(src, bestContour);
                    }
                    
                    src.delete();
                    gray.delete();
                    blurred.delete();
                    edges.delete();
                    contours.delete();
                    hierarchy.delete();
                    if (bestContour) bestContour.delete();
                    
                    resolve(result);
                } catch (err) {
                    console.error('Detection error:', err);
                    resolve(imageUrl);
                }
            };
            
            img.onerror = () => resolve(imageUrl);
            img.src = imageUrl;
        });
    } catch (error) {
        return imageUrl;
    }
}

function applyPerspective(src, contour) {
    try {
        const points = [];
        for (let i = 0; i < contour.rows; i++) {
            points.push({
                x: contour.data32S[i * 2],
                y: contour.data32S[i * 2 + 1]
            });
        }
        
        points.sort((a, b) => a.y - b.y);
        const top = points.slice(0, 2).sort((a, b) => a.x - b.x);
        const bottom = points.slice(2, 4).sort((a, b) => a.x - b.x);
        const ordered = [...top, ...bottom.reverse()];
        
        const cardWidth = 350;
        const cardHeight = 500;
        
        const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            ordered[0].x, ordered[0].y,
            ordered[1].x, ordered[1].y,
            ordered[2].x, ordered[2].y,
            ordered[3].x, ordered[3].y
        ]);
        
        const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            cardWidth, 0,
            cardWidth, cardHeight,
            0, cardHeight
        ]);
        
        const M = cv.getPerspectiveTransform(srcPoints, dstPoints);
        const dst = new cv.Mat();
        const dsize = new cv.Size(cardWidth, cardHeight);
        
        cv.warpPerspective(src, dst, M, dsize);
        
        const canvas = document.createElement('canvas');
        cv.imshow(canvas, dst);
        const result = canvas.toDataURL('image/jpeg', config.quality);
        
        srcPoints.delete();
        dstPoints.delete();
        M.delete();
        dst.delete();
        
        return result;
    } catch (error) {
        console.error('Perspective error:', error);
        const canvas = document.createElement('canvas');
        cv.imshow(canvas, src);
        return canvas.toDataURL('image/jpeg', config.quality);
    }
}
