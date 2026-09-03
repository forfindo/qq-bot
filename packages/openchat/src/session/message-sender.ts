import { Context } from 'effect';

export interface Interface {
  uid: string;
  type: 'group' | 'private';
  groupID?: string;
}

export class Service extends Context.Service<Service, Interface>()('@openchat/MessageSender') {}
