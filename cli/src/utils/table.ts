import Table from 'cli-table3';
import chalk from 'chalk';

export function printTable(
  headers: string[],
  rows: string[][],
  options?: { json?: boolean }
): void {
  if (options?.json) {
    const result = rows.map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = row[i]));
      return obj;
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
    wordWrap: true,
    wrapOnWordBoundary: false,
  });
  table.push(...rows);
  console.log(table.toString());
}

export function printKeyValue(pairs: [string, string][]): void {
  const labelWidth = Math.max(...pairs.map(([k]) => k.length)) + 2;
  for (const [key, value] of pairs) {
    console.log(`${chalk.dim(key.padEnd(labelWidth))}${value}`);
  }
}

export function printSuccess(msg: string): void {
  console.log(`${chalk.green('✓')} ${msg}`);
}

export function printError(msg: string): void {
  console.error(`${chalk.red('✗')} ${msg}`);
}

export function printWarning(msg: string): void {
  console.log(`${chalk.yellow('!')} ${msg}`);
}
