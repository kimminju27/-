import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .board-list li, .item, article',
    titleSelector: '[class*="title"], h3, h4, .subject',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], .deadline',
  })
}
