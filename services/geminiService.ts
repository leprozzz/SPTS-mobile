
import { GoogleGenAI } from "@google/genai";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async getAiAdvice(prompt: string, context?: string) {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `
          Context: You are a field service expert assistant for an OTRS ticketing system.
          Technical Context: ${context || 'General field work.'}
          
          User request: ${prompt}
        `,
        config: {
          temperature: 0.7,
        }
      });
      return response.text;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Sorry, I am having trouble connecting to my brain right now.";
    }
  }
}

export const geminiService = new GeminiService();
