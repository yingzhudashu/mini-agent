import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { RegisteredTool, ToolDefinition, ToolRegistry } from "./types.js";

/**
 * Dynamic tool registry.
 * Tools can be registered/unregistered at runtime.
 */
export class DefaultToolRegistry implements ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(name: string, tool: ToolDefinition): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
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
}
