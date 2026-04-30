import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { RegisteredTool, ToolDefinition, ToolRegistry } from "./types.js";

export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(name: string, tool: ToolDefinition): void {
    if (this.tools.has(name)) throw new Error(`Tool "${name}" already registered`);
    this.tools.set(name, { ...tool, name });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getAll(): Map<string, RegisteredTool> {
    return new Map(this.tools);
  }

  getSchemas(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((t) => t.schema);
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }

  getSchemasByToolboxes(ids: string[]): ChatCompletionTool[] {
    if (ids.length === 0) return this.getSchemas();
    const idSet = new Set(ids);
    return Array.from(this.tools.values())
      .filter((t) => !t.toolbox || idSet.has(t.toolbox))
      .map((t) => t.schema);
  }

  getByToolboxes(ids: string[]): Map<string, RegisteredTool> {
    if (ids.length === 0) return this.getAll();
    const idSet = new Set(ids);
    const filtered = new Map<string, RegisteredTool>();
    for (const [name, tool] of this.tools) {
      if (!tool.toolbox || idSet.has(tool.toolbox)) {
        filtered.set(name, tool);
      }
    }
    return filtered;
  }
}
