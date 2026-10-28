export function petSpeech(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = flat.split(/(?<=[。！？!?])/)[0] ?? flat
  if (sentence.length <= 40) return sentence
  return `${sentence.slice(0, 40)}…`
}
