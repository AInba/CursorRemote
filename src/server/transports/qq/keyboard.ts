export interface QqButton {
  id: string;
  label: string;
  style?: 0 | 1;
}

export function callbackKeyboard(buttons: QqButton[]): object {
  const rows: { buttons: object[] }[] = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push({
      buttons: buttons.slice(i, i + 3).map(button => ({
        id: button.id,
        render_data: {
          label: button.label.slice(0, 20),
          visited_label: button.label.slice(0, 20),
          style: button.style ?? 0,
        },
        action: {
          type: 1,
          permission: { type: 2 },
          data: button.id,
        },
      })),
    });
  }
  return { content: { rows } };
}

export function withDoHints(intro: string, buttons: QqButton[]): string {
  const hints = buttons.map(button => `${button.label}: /do ${button.id}`).join('\n');
  return hints ? `${intro}\n${hints}` : intro;
}
