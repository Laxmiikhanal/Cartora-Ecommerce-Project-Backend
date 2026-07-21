import axios from 'axios';

export const verifyRecaptcha = async (token) => {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;

    if (!secretKey) {
        if (process.env.NODE_ENV === 'development') {
            console.warn("reCAPTCHA skipped in development mode");
            return true;
        }
        throw new Error("RECAPTCHA_SECRET_KEY is missing in production");
    }

    try {
        const response = await axios.post(
            `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`
        );

        const data = response.data;

        // v3 returns a score (0.0 to 1.0)
        // We can check if success is true and score is high enough
        if (data.success && data.score >= 0.5) {
            return true;
        }

        console.warn("reCAPTCHA validation failed:", data);
        return false;

    } catch (error) {
        console.error("reCAPTCHA verification error:", error);
        return false;
    }
};
