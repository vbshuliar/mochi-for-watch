// Deliberately narrow: no greetings, factual answers, approvals or task claims.
export function localIntent(text){
 const value=text.trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(repeat that|say that again|repeat your last (reply|answer))$/.test(value))return 'repeat';
 if(/^(stop talking|stop speaking|be quiet)$/.test(value))return 'stop';
 return null;
}
