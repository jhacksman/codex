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

  private formatMessages(instructions: string, input: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const messages = [
      { role: "system", content: instructions }
    ];
    
    for (const item of input) {
      if (item['content'] && Array.isArray(item['content'])) {
        const contentArray = item['content'] as Array<Record<string, unknown>>;
        let textContent = "";
        
        for (const contentItem of contentArray) {
          if (contentItem['type'] === "input_text" && typeof contentItem['text'] === "string") {
            textContent += contentItem['text'];
          } else if (contentItem['type'] === "input_image") {
            continue;
          }
        }
        
        messages.push({
          role: (item['role'] as string) || "user",
          content: textContent
        });
      } else if (item['text'] && typeof item['text'] === "string") {
        messages.push({
          role: (item['role'] as string) || "user",
          content: item['text']
        });
      } else if (item['content'] && typeof item['content'] === "string") {
        messages.push({
          role: (item['role'] as string) || "user",
          content: item['content']
        });
      }
    }
    
    return messages;
  }

  async *responses(params: {
    instructions: string;
    input: Array<Record<string, unknown>>;
    stream: boolean;
  }): AsyncGenerator<VeniceStreamResponse> {
    try {
      const messages = this.formatMessages(params.instructions, params.input);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          stream: params.stream
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

        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) { break; }

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
                
                if (data.choices && data.choices.length > 0) {
                  const choice = data.choices[0];
                  
                  if (choice.delta && choice.delta.content) {
                    const content = this.filterThinkTags(choice.delta.content);
                    
                    yield {
                      id: data.id || `venice-${Date.now()}`,
                      type: "response.output_item.done",
                      content: [{ type: "input_text", text: content }],
                      role: "assistant",
                    };
                  }
                }
              } catch (error: unknown) {
                // Ignore JSON parsing errors in stream data
                console.error("Error parsing stream data:", error);
              }
            }
          }
        }
      } else {
        const data = await response.json();
        
        if (data.choices && data.choices.length > 0) {
          const choice = data.choices[0];
          
          if (choice.message && choice.message.content) {
            const content = this.filterThinkTags(choice.message.content);
            
            yield {
              id: data.id || `venice-${Date.now()}`,
              type: "response.completed",
              content: [{ type: "input_text", text: content }],
              role: "assistant",
            };
          }
        }
      }
    } catch (error) {
      console.error("Venice API request failed:", error);
      throw error;
    }
  }
}
