import { Context } from 'effect';

export const withSenderInfo = (input: string, sender: Interface) => {
  return JSON.stringify({
    nickname: sender.nickname,
    uid: sender.uid,
    channelType: sender.channelType,
    channelID: sender.channelID,
    channelName: sender.channelName,
    timestamp: sender.timestamp,
    message: input
  });
};

export interface Interface {
  nickname: string;
  uid: string;
  channelType: string;
  channelID?: string;
  channelName?: string;
  timestamp: number;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/MessageSender') {}
