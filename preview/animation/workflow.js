'use strict';
// Proposed Muse for Watch states, informed by public Moment workflows; all services simulated.
const workflowStates={
 connecting:{name:'Connect',icon:'↗',sub:'Finding the service',status:'connecting…',pose:{eye:.85,gx:18,gy:-15,angle:-4,smile:10}},
 transcribe:{name:'Understand',icon:'≋',sub:'Making sense of speech',status:'got it, one moment…',pose:{eye:.85,gy:9,angle:3,smile:15,brow:5}},
 clarify:{name:'Clarify',icon:'?',sub:'Ask, don’t guess',status:'which day did you mean?',pose:{eye:1.06,asym:15,brow:11,gx:8,angle:-9,smile:9,width:32}},
 route:{name:'Hand off',icon:'⇢',sub:'Choose a specialist',status:'asking Calendar buddy…',pose:{eye:.98,gx:24,angle:6,smile:17}},
 approval:{name:'Approval',icon:'✓',sub:'Wait for your decision',status:'add lunch at 1? tap yes',pose:{eye:1.1,gy:-4,brow:8,angle:-3,smile:21,scale:1.025}},
 working:{name:'Working',icon:'↻',sub:'Doing the task',status:'adding your event…',pose:{eye:.78,gx:-10,gy:15,angle:3,smile:12,width:38}},
 waiting:{name:'Waiting',icon:'…',sub:'Service taking longer',status:'still waiting on Calendar…',pose:{eye:.68,gx:13,gy:-5,angle:4,smile:8}},
 partial:{name:'Partial result',icon:'½',sub:'Be honest about progress',status:'saved draft, not sent',pose:{eye:.85,asym:8,brow:5,angle:-4,smile:10}},
 error:{name:'Try again',icon:'!',sub:'Recoverable failure',status:'couldn’t save. tap to retry',pose:{eye:.75,brow:5,asym:10,angle:5,smile:-8,width:32}},
 offline:{name:'Offline',icon:'○',sub:'No service connection',status:'offline · tap to reconnect',pose:{eye:.2,gy:8,angle:8,smile:3,scale:.98}},
 permission:{name:'Permission',icon:'⌑',sub:'Needs phone access',status:'connect Calendar on iPhone',pose:{eye:1,gy:0,angle:-5,asym:9,smile:7}},
 cancelled:{name:'Cancelled',icon:'×',sub:'Nothing was changed',status:'cancelled · nothing changed',pose:{eye:.7,angle:0,smile:12}},
 reminder:{name:'Nudge',icon:'✦',sub:'Something needs attention',status:'your meeting is in 5 min',pose:{eye:1.18,brow:14,angle:-3,smile:23,scale:1.03}}
};
const stateGroups={
 conversation:['sleep','idle','wake','listen','transcribe','think','search','speak','clarify'],
 work:['connecting','route','approval','working','waiting','partial','reminder','happy'],
 emotions:['confused','curious','surprised','delighted','loved','happy'],
 recovery:['error','offline','permission','cancelled']
};
