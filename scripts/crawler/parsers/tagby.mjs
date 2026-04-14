import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '[class*="campaign"], .list li, article, .item',
    titleSelector: '[class*="title"], h3, h4',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel, .sns',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], .deadline',
  })
}
