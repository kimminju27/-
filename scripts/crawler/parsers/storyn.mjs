import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .campaign-list li, .item, .campaign-item',
    titleSelector: '[class*="title"], h3, h4',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel, .media',
    applicantsSelector: '[class*="apply"], [class*="count"]',
    capacitySelector: '[class*="limit"], [class*="total"]',
    deadlineSelector: '[class*="day"], .deadline',
  })
}
