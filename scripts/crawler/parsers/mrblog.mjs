import { genericParse } from './_generic.mjs'
export async function parse(url) {
  return genericParse(url, {
    listSelector: '.list li, .campaign-list li, .item, article.post, .entry',
    titleSelector: '[class*="title"], h2, h3, .subject',
    linkSelector: 'a',
    typeSelector: '.type, .channel, [class*="type"]',
    applicantsSelector: '.count, [class*="apply"]',
    capacitySelector: '.total, [class*="limit"]',
    deadlineSelector: '.date, .deadline, [class*="day"]',
  })
}
