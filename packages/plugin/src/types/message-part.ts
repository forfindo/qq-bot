export interface Text {
  type: 'text';
  text: string;
}

export interface Image {
  type: 'image';
  path: string;
  content?: string;
}

export type Part = Text | Image;
