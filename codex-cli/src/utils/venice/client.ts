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
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: params.instructions },
            ...params.input.map((item) => {
              return { 
                role: item['role'] || "user", 
                content: item['content'] || item['text'] || "",
              };
            }),
          ],
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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

                if (data.content) {
                  data.content = this.filterThinkTags(data.content);
                }

                yield {
                  id: data.id || `venice-${Date.now()}`,
                  type: "response.output_item.done",
                  content: [{ type: "input_text", text: data.content || "" }],
                  role: data.role || "assistant",
                };
              } catch (e) {
              }
            }
          }
        }
      } else {
        const data = await response.json();

        if (data.content) {
          data.content = this.filterThinkTags(data.content);
        }

        yield {
          id: data.id || `venice-${Date.now()}`,
          type: "response.completed",
          content: [{ type: "input_text", text: data.content || "" }],
          role: data.role || "assistant",
        };
      }
    } catch (error) {
      throw error;
    }
  }
}
