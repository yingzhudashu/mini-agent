/**
 * @file output-manager.ts — CLI 输出管理器
 * @description
 *   解决 readline 与异步输出之间的冲突问题。
 *
 *   问题场景：
 *   当 Agent 正在执行工具（异步操作）时，readline 的 prompt 仍然显示在终端上。
 *   如果工具输出通过 console.log 打印到终端，会与用户的输入行交错，导致：
 *   - 输出内容覆盖 prompt
 *   - 用户输入被截断或丢失
 *   - 终端显示混乱
 *
 *   解决方案：
 *   1. 异步操作前：调用 beginOutput() 清除 prompt 行
 *   2. 执行输出：通过 write/writeLines 打印内容
 *   3. 异步操作后：调用 endOutput() 重绘 prompt 并恢复 readline
 *
 *   设计原则：
 *   - 零侵入：不需要修改 agent.ts 的核心逻辑
 *   - 自动管理：CLI 层自动调用，用户无感知
 *   - 缓冲区安全：支持连续多次输出，只在最后重绘 prompt
 *
 * @module core/output-manager
 */

import readline from "readline";

/**
 * CLI 输出管理器
 *
 * 解决 readline 与异步输出之间的冲突问题。
 *
 * 问题场景：
 * 当 Agent 正在执行工具（异步操作）时，readline 的 prompt 仍然显示在终端上。
 * 如果工具输出通过 console.log 打印到终端，会与用户的输入行交错，导致：
 * - 输出内容覆盖 prompt
 * - 用户输入被截断或丢失
 * - 终端显示混乱
 *
 * 解决方案：
 * 1. 异步操作前：调用 beginOutput() 清除 prompt 行
 * 2. 执行输出：通过 write/writeLines 打印内容
 * 3. 异步操作后：调用 endOutput() 重绘 prompt 并恢复 readline
 *
 * 设计原则：
 * - 零侵入：不需要修改 agent.ts 的核心逻辑
 * - 自动管理：CLI 层自动调用，用户无感知
 * - 缓冲区安全：支持连续多次输出，只在最后重绘 prompt
 *
 * @example
 *   const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
 *   const om = new OutputManager(rl, "\n> ");
 *
 *   om.beginOutput();
 *   console.log("工具执行中...");
 *   om.endOutput();
 *
 *   // 或者使用便捷方法
 *   om.write("这是一行输出");
 *   om.writeLines(["第一行", "第二行"]);
 */
export class OutputManager {
  /** 底层 readline 接口 */
  private rl: readline.Interface;
  /** Prompt 字符串，用于重绘 */
  private readonly promptStr: string;
  /** 是否正在输出中（用于判断是否需要清除行） */
  private inOutput = false;
  /** 输出计数器（支持嵌套 beginOutput/endOutput） */
  private outputDepth = 0;
  /** readline 是否已关闭（手动跟踪，因为 rl.closed 不是公开 API） */
  private isClosed = false;

  /**
   * 创建输出管理器
   *
   * @param rl - readline 接口实例
   * @param prompt - Prompt 字符串，默认 "\n> "
   */
  constructor(rl: readline.Interface, prompt = "\n> ") {
    this.rl = rl;
    this.promptStr = prompt;
    // 监听关闭事件
    rl.on("close", () => {
      this.isClosed = true;
    });
  }

  /**
   * 开始输出阶段：清除当前行，暂停 readline
   *
   * 应在任何异步操作（工具执行、LLM 调用等）输出日志前调用。
   * 支持嵌套调用（计数器模式），只有第一次调用会清除行。
   */
  beginOutput(): void {
    if (this.isClosed) return; // 已关闭则跳过
    if (this.outputDepth === 0) {
      this.rl.pause();
      // 清除当前行（prompt 和用户可能输入的内容）
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      this.inOutput = true;
    }
    this.outputDepth++;
  }

  /**
   * 结束输出阶段：重绘 prompt，恢复 readline
   *
   * 与 beginOutput() 配对使用。
   * 只有当计数器归零时才重绘 prompt。
   */
  endOutput(): void {
    if (this.isClosed) {
      this.outputDepth = 0;
      this.inOutput = false;
      return;
    }
    if (this.outputDepth > 0) {
      this.outputDepth--;
    }
    if (this.outputDepth === 0 && this.inOutput) {
      // 重绘 prompt
      process.stdout.write(this.promptStr);
      this.rl.resume();
      this.inOutput = false;
    }
  }

  /**
   * 安全输出单行文本
   *
   * 自动包裹 beginOutput/endOutput，适合单次输出。
   */
  write(text: string): void {
    this.beginOutput();
    process.stdout.write(text + "\n");
    this.endOutput();
  }

  /**
   * 安全输出多行文本
   */
  writeLines(lines: string[]): void {
    this.beginOutput();
    for (const line of lines) {
      process.stdout.write(line + "\n");
    }
    this.endOutput();
  }

  /**
   * 获取底层 readline 接口
   *
   * 仅在特殊场景下使用（如需要直接操作 readline 的事件监听器）。
   * 一般应通过 beginOutput/endOutput/write/writeLines 进行输出。
   *
   * @returns readline.Interface 实例
   */
  getReadline(): readline.Interface {
    return this.rl;
  }
}
