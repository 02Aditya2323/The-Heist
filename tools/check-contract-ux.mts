import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMap,type EventView} from '@heist/shared';
import {nearbyInteractions} from '../apps/client/src/engine/interactions.js';
import {activeContracts,availableContracts,completedContracts} from '../apps/client/src/ui/contracts-model.js';
const map=loadMap(JSON.parse(readFileSync('maps/art-world.json','utf8')));
const gate=map.exits!.find(e=>e.id==='c07-back-b')!;
const choices=nearbyInteractions(map,gate.x,gate.y);
assert(choices.some(c=>c.id===gate.id&&c.kind==='exit'));
assert(choices.some(c=>c.id==='logic'&&c.kind==='terminal'));
assert.equal(choices[0].id,gate.id,'Exact-coordinate tie gives travel a deterministic first choice');
assert(!nearbyInteractions(map,gate.x+10,gate.y).some(c=>c.id===gate.id));
const event={challenges:[{id:'done',title:'SD-02 · Lonely Packet',reward:2000,solved:true},{id:'active',solved:false}],
  jobs:[{id:'SD-02',title:'Lonely Packet',station:'data-centre',district:'harbor'},{id:'SD-05'}],
  completedChallenges:[{id:'done',template:'SD-02',title:'SD-02 · Lonely Packet',mode:'job',completedAt:1,location:'Data Harbor · Data Centre'}]} as EventView;
assert.deepEqual(activeContracts(event).map(c=>c.id),['active']);
assert.deepEqual(availableContracts(event).map(c=>c.id),['SD-05']);
assert.equal(completedContracts(event)[0].location,'Data Harbor · Data Centre');
assert.equal(completedContracts({...event,challenges:[]}).length,1,'History remains after recent puzzle cards disappear');
assert.equal(availableContracts({...event,completedChallenges:[{...event.completedChallenges![0],mode:'training'}]}).length,2,'Training does not hide eligible paid work');
assert.equal(completedContracts({...event,completedChallenges:undefined},map)[0].location,'Data Harbor · Data Centre');
assert.equal(completedContracts({...event,challenges:[],completedChallenges:[]}).length,0,'New rounds do not retain old completions');
console.log('PASS completed/active/available contract separation, locations, older-server fallback, round reset and coincident gate/terminal choices.');
