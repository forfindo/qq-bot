import { Context } from 'effect';

export interface Interface {
  nickname: string;
  uid: string;
  channelType: string;
  channelID?: string;
  channelName?: string;
  timestamp: number;
  message: string;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/MessageSender') {}
