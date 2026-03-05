
import { GoogleGenAI } from "@google/genai";
import knowledgeBase from '../knowledge-base.txt?raw';

export class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  async getAiAdvice(prompt: string, context?: string) {
    if (!this.ai) {
      console.warn("Gemini API Key missing. Returning mock response.");
      return "Gemini API je trenutno isključen. Ovo je demo odgovor baziran na lokalnim podacima.";
    }

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `
          System Instruction: You are a field service expert assistant for an OTRS ticketing system.
          You have access to the following technical knowledge base. Use it to answer user questions accurately.
          
          --- KNOWLEDGE BASE START ---
          ${knowledgeBase}
          --- KNOWLEDGE BASE END ---

          Current Ticket Context: ${context || 'General field work.'}
          
          User request: ${prompt}
        `,
        config: {
          temperature: 0.3, // Lower temperature for more factual answers based on the KB
        }
      });
      return response.text || "Nisam uspio generisati odgovor.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Izvinite, trenutno imam problema sa povezivanjem.";
    }
  }
}

export const geminiService = new GeminiService();
