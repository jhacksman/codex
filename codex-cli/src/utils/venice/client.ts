export interface VeniceStreamResponse {
  id: string;
  type: string;
  content?: Array<{
    type: string;
    text: string;
  }>;
  role?: string;
  call_id?: string;
}

export interface VeniceConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export class VeniceClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: VeniceConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.endsWith("/")
      ? config.baseUrl.slice(0, -1)
      : config.baseUrl;
    this.model = config.model;
  }

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };
  }

  private filterThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>/g, "");
  }

  async *responses(params: {
    instructions: string;
    input: Array<Record<string, unknown>>;
    stream: boolean;
  }): AsyncGenerator<VeniceStreamResponse> {
    const messages = [
      { role: "system", content: params.instructions }
    ];
    
    for (const item of params.input) {
      let content = "";
      if (typeof item['content'] === "string") {
        content = item['content'];
      } else if (typeof item['text'] === "string") {
        content = item['text'];
      } else if (Array.isArray(item['content'])) {
        const contentArray = item['content'] as Array<Record<string, unknown>>;
        content = contentArray
          .map(c => typeof c['text'] === "string" ? c['text'] : "")
          .filter(Boolean)
          .join("\n");
      }
      
      messages.push({
        role: typeof item['role'] === "string" ? item['role'] : "user",
        content: content
      });
    }
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: params.stream,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Venice API error: ${response.status} - ${error}`);
    }

    if (params.stream && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let responseId = `venice-${Date.now()}`;

      while (true) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) { 
          yield {
            id: responseId,
            type: "response.completed",
            content: [{ type: "input_text", text: "Response complete" }],
            role: "assistant",
          };
          break; 
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "" || line.trim() === "data: [DONE]") {
            continue;
          }
          
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              
              let content = "";
              if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                const message = data.choices[0].message;
                content = message.content || "";
                
                content = this.filterThinkTags(content);
                
                if (data.id) {
                  responseId = data.id;
                }
                
                yield {
                  id: responseId,
                  type: "response.output_item.done",
                  content: [{ type: "input_text", text: content }],
                  role: message.role || "assistant",
                };
              }
            } catch (error: unknown) {
              console.error("Error parsing Venice API response:", error);
            }
          }
        }
      }
    } else {
      const data = await response.json();
      let content = "";
      let role = "assistant";
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        const message = data.choices[0].message;
        content = message.content || "";
        role = message.role || "assistant";
        
        content = this.filterThinkTags(content);
      }

      yield {
        id: data.id || `venice-${Date.now()}`,
        type: "response.completed",
        content: [{ type: "input_text", text: content }],
        role: role,
      };
    }
  }
}
