import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export const cameraService = {
    /**
     * Capture image using device camera
     */
    async captureFromCamera() {
        if (!Capacitor.isNativePlatform()) {
            return await this.pickFromFileInput();
        }

        try {
            const image = await Camera.getPhoto({
                quality: 85,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Camera
            });

            return {
                base64: image.base64String,
                mimeType: `image/${image.format || 'jpeg'}`
            };
        } catch (error) {
            console.warn('[CAMERA] Camera capture cancelled or failed:', error.message);
            throw error;
        }
    },

    /**
     * Pick image from device photo gallery
     */
    async pickFromGallery() {
        if (!Capacitor.isNativePlatform()) {
            return await this.pickFromFileInput();
        }

        try {
            const image = await Camera.getPhoto({
                quality: 85,
                allowEditing: false,
                resultType: CameraResultType.Base64,
                source: CameraSource.Photos
            });

            return {
                base64: image.base64String,
                mimeType: `image/${image.format || 'jpeg'}`
            };
        } catch (error) {
            console.warn('[CAMERA] Gallery pick cancelled or failed:', error.message);
            throw error;
        }
    },

    /**
     * Fallback for browser testing when camera plugin is not on native device
     */
    pickFromFileInput() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = (e) => {
                const file = e.target.files?.[0];
                if (!file) {
                    reject(new Error('No image selected'));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    const result = reader.result;
                    const base64 = result.split(',')[1];
                    resolve({
                        base64,
                        mimeType: file.type || 'image/jpeg'
                    });
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            };
            input.click();
        });
    }
};
