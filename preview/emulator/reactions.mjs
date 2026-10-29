// Conservative, local English cues. Neutral is the default; these are visual
// suggestions, not sentiment analysis or claims about the user's feelings.
export const reactionPresentation={
 loved:{text:'aww, thank you!',duration:4400},
 delighted:{text:'that’s lovely!',duration:2800},
 surprised:{text:'oh, wow!',duration:2400},
 curious:{text:'tell me more',duration:2400},
 confused:{text:'let’s work it out',duration:2600},
};
export function reactionFor(text='',reply='',state='speak') {
 const normalize=value=>value.toLowerCase().replace(/[’‘]/g,"'");
 const input=normalize(text),answer=normalize(reply),both=input+' '+answer;
 // Never decorate distress, harm or operational failure with a cheerful cue.
 if(/\b(died|death|grief|grieving|funeral|suicide|hurt|injured|hospital|abuse|scared|terrified|depressed|lonely|crying|heartbroken|lost my|fired|laid off|bad news|sorry to hear)\b/.test(both))return null;
 if(!['speak','clarify'].includes(state))return null;
 const negative=/\b(not|never|hate|don't|do not|aren't|isn't|wasn't|weren't)\b/.test(input);
 const addressed=/\b(?:you(?:'re| are)|mochi(?: is|,? you're)?)\s+(?:(?:so|really|very|super|absolutely|such a|the)\s+)*(?:cute|adorable|sweet|lovely|wonderful|amazing|awesome|great|best|helpful|kind|cool)\b/;
 const affection=/\b(?:i (?:(?:really|truly|absolutely|so|much)\s+)*love you|love you(?:,? mochi)?|you're my favo(?:u)?rite|you are my favo(?:u)?rite|good job(?: mochi)?|well done(?: mochi)?)\b/;
 if(!negative&&(addressed.test(input)||affection.test(input)))return 'loved';
 if(/\b(i'm not sure|i am not sure|could you clarify|did you mean|not quite sure|don't quite understand)\b/.test(answer))return 'confused';
 if(state==='clarify')return 'curious';
 const goodNews=/\b(i (?:just )?(?:passed|won|graduated)|i got (?:the|a) (?:job|promotion)|we (?:won|did it)|good news)\b/;
 if(!negative&&goodNews.test(input)&&!/\b(unfortunately|sorry|not|never)\b/.test(answer))return 'delighted';
 if(!negative&&/\b(wow|that's unexpected|what a surprise|incredible)\b/.test(answer))return 'surprised';
 if(/\?\s*$/.test(answer)&&/\b(what|which|how|tell me|would you|could you)\b/.test(answer))return 'curious';
 if(/^(hi|hello|hey)(?: mochi)?[!.\s]*$/.test(input)&&/\b(hi|hello|hey|glad|happy)\b/.test(answer))return 'delighted';
 return null;
}
