export interface IterationStopReason {
  message: string;
}

export class IterationGuard {
  private failedAttempts = new Map<string, number>();
  private consecutiveEmptyIterations = 0;
  private completedWrites = new Map<string, string>();

  static fingerprint(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${JSON.stringify(args)}`;
  }

  recordSuccessfulWrite(filePath: string, content: string): void {
    this.completedWrites.set(filePath, content);
  }

  checkRedundantAction(
    toolName: string,
    args: Record<string, unknown>
  ): IterationStopReason | null {
    const filePath = args.path as string | undefined;
    if (!filePath) {
      return null;
    }

    const doneContent = this.completedWrites.get(filePath);
    if (doneContent === undefined) {
      return null;
    }

    if (toolName === 'read_file') {
      return {
        message: `Tarefa concluída — \`${filePath}\` já foi salvo com o conteúdo correto.`,
      };
    }

    if (toolName === 'create_file' || toolName === 'modify_file' || toolName === 'edit_file') {
      const newContent = (args.content ?? args.new_content) as string | undefined;
      if (newContent === undefined || newContent === doneContent) {
        return {
          message: `Tarefa concluída — \`${filePath}\` já contém o conteúdo solicitado.`,
        };
      }
    }

    return null;
  }

  recordToolResult(
    toolName: string,
    args: Record<string, unknown>,
    success: boolean,
    output: string
  ): IterationStopReason | null {
    let fp = IterationGuard.fingerprint(toolName, args);
    const recoverableEdit = !success && this.isRecoverableEditFailure(toolName, output);

    if (!success && toolName === 'edit_file') {
      fp = `edit_file-fail:${String(args.path ?? 'unknown')}`;
    }

    if (success) {
      this.failedAttempts.delete(fp);
      return null;
    }

    const count = (this.failedAttempts.get(fp) ?? 0) + 1;
    this.failedAttempts.set(fp, count);

    if (recoverableEdit && count < 6) {
      return null;
    }

    if (count >= 2) {
      return {
        message: `Interrompido: a mesma ação falhou ${count} vezes sem progresso.\nÚltimo erro: ${output}`,
      };
    }

    if (this.isNonRetryable(output)) {
      return {
        message: `Interrompido: não adianta repetir a mesma ação.\n${output}`,
      };
    }

    return null;
  }

  private isRecoverableEditFailure(toolName: string, output: string): boolean {
    if (toolName !== 'edit_file') {
      return false;
    }
    return output.includes('verify_content')
      || output.includes('old_text não encontrado')
      || output.includes('start_line')
      || output.includes('além do fim')
      || output.includes('search_replace desativado')
      || output.includes('replace_lines');
  }

  finishIteration(hadSuccess: boolean): IterationStopReason | null {
    if (hadSuccess) {
      this.consecutiveEmptyIterations = 0;
      return null;
    }

    this.consecutiveEmptyIterations++;
    if (this.consecutiveEmptyIterations >= 2) {
      return {
        message: 'Interrompido: o agente não conseguiu progresso nas últimas iterações.',
      };
    }

    return null;
  }

  private isNonRetryable(output: string): boolean {
    const lower = output.toLowerCase();
    return lower.includes('permissão negada')
      || lower.includes('ferramenta desconhecida')
      || (lower.includes('parâmetros') && lower.includes('obrigatório'));
  }

  reset(): void {
    this.failedAttempts.clear();
    this.consecutiveEmptyIterations = 0;
    this.completedWrites.clear();
  }
}
