import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .campaign-list li, article, .item-wrap',
    titleSelector: '[class*="title"], h3, h4, .subject',
    linkSelector: 'a',
    typeSelector: '[class*="type"], .channel',
    applicantsSelector: '[class*="apply"], .count',
    capacitySelector: '[class*="limit"], .total',
    deadlineSelector: '[class*="day"], .deadline',
  })
}
