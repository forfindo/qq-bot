import { Context } from 'effect';

export const withSenderInfo = (input: string, sender: Interface) => {
  if (sender.type === 'user') {
    return JSON.stringify({
      nickname: sender.source.nickname,
      uid: sender.source.uid,
      channelType: sender.channelType,
      channelID: sender.channelInfo?.channelID,
      channelName: sender.channelInfo?.channelName,
      time: sender.time,
      message: input
    });
  } else if (sender.type === 'system') {
    return JSON.stringify({
      type: sender.eventType,
      channelType: sender.channelType,
      channelID: sender.channelInfo?.channelID,
      channelName: sender.channelInfo?.channelName,
      time: sender.time,
      content: input,
      source: sender.source
    });
  } else {
    return '不支持的消息类型';
  }
};

export interface UserInterface {
  type: 'user';
  source: {
    uid: string;
    nickname: string;
  };
  channelType: string;
  channelInfo?: {
    channelID: string;
    channelName: string;
  };
  time: string;
}

export type SystemInterface =
  | {
      type: 'system';
      eventType: string;
      channelType: string;
      time: string;
      channelInfo?: {
        channelID: string;
        channelName: string;
      };
      source: {
        uid: string;
        nickname: string;
      };
    }
  | {
      type: 'system';
      eventType: string;
      channelType: string;
      time: string;
      channelInfo: {
        channelID: string;
        channelName: string;
      };
      source?: {
        uid: string;
        nickname: string;
      };
    };

export type Interface = UserInterface | SystemInterface;

export class Service extends Context.Service<Service, Interface>()('@openchat/MessageSender') {}
