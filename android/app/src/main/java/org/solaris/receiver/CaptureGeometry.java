package org.solaris.receiver;

/** Even encoder dimensions without stretching or upscaling a screen. */
final class CaptureGeometry {
    static int[] fit(int width, int height, int longEdge, int shortEdge) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("Invalid screen bounds");
        double scale = Math.min(1.0, Math.min((double)longEdge / Math.max(width, height), (double)shortEdge / Math.min(width, height)));
        return new int[]{Math.max(2, (int)(width * scale) / 2 * 2), Math.max(2, (int)(height * scale) / 2 * 2)};
    }
}
