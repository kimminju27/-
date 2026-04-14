import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '[class*="campaign"], [class*="place"], .list li, article',
    titleSelector: '[class*="title"], [class*="name"], h3, h4',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], .deadline',
  })
}
