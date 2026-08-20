// كود مؤقت لتجاوز خطأ البناء في Vercel
export const neonService = {
  getData: async () => {
    console.warn("Neon service is running in mock mode.");
    return [];
  },
  saveData: async () => {
    console.warn("Neon service is running in mock mode.");
    return true;
  }
};

export default neonService;
