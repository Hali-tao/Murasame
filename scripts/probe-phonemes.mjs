import { phonemize } from 'phonemizer'
for (const lang of ['cmn', 'zh', 'cmn-latn-pinyin', 'en-us']) {
  try {
    const out = await phonemize('今天任务完成了', lang)
    console.log(lang, '=>', JSON.stringify(out))
  } catch (error) {
    console.log(lang, '=> FAIL', error instanceof Error ? error.message.slice(0, 80) : error)
  }
}
