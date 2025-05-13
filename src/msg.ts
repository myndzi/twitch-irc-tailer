import avro from 'avsc';

const User = avro.Type.forSchema({
  type: 'record',
  name: 'user',
  fields: [
    {name: 'id', type: 'string'},
    {name: 'login', type: 'string'},
    {name: 'displayName', type: 'string'},
  ]
});
const type = avro.Type.forSchema({
  type: 'record',
  name: 'event',
  fields: [
    {name: 'name', type: 'string'},
    {name: 'ts', type: 'number'},
    {name: 'id', type: 'string'},
    {name: 'user', type: avro.types.UnwrappedUnionType[avro.Type., User]}
    
      // /**
      //  * The channel that the event occurredin
      //  */
      // channel?: Partial<Channel>;
    
      // /**
      //  * The user the event is attributed to
      //  */
      // user?: Partial<User>;
      // /**
      //  * For non-anonymous gifts, whatever user data
      //  * we could aquire about the gifter. The message
      //  * is sent by the recipient, so that will be
      //  * the "user"
      //  */
      // gifter?: Partial<User>;
      // /**
      //  * For moderator actions, whatever user data
      //  * we could acquire about the target of the
      //  * action (e.g. ban, timeout...)
      //  */
      // target?: Partial<User>;
    
      // /**
      //  * Data that was bound from the event handler callback but not
      //  * handled explicitly
      //  */
      // args?: { [key: string]: unknown };
    
      // /**
      //  * Data that was present in IRC tags but not handled explicitly
      //  */
      // tags?: { [key: string]: unknown };

    
  ]
})