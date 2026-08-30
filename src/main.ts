import { DiceGame } from './game'
import { clearHistory, loadHistory, pushRoll, type Roll } from './history'
import { listenForShake, requestShakePermission, shakeNeedsPermission } from './shake'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const stage = $('stage')
const total = $('total')
const detail = $('detail')
const counter = $('counter')
const historyList = $<HTMLUListElement>('history-list')
const clearButton = $<HTMLButtonElement>('clear-history')
const shakeButton = $<HTMLButtonElement>('enable-shake')

const game = new DiceGame(stage)
let history = loadHistory()

function renderHistory() {
  historyList.replaceChildren(
    ...history.map((roll: Roll) => {
      const li = document.createElement('li')
      li.textContent = `${roll.values.join(' · ')} → ${roll.total}`
      return li
    }),
  )
  clearButton.hidden = history.length === 0
}

game.onRolling = () => {
  total.textContent = '…'
  detail.textContent = ''
}

game.onSettle = (values) => {
  total.textContent = String(values.reduce((a, b) => a + b, 0))
  detail.textContent = values.length > 1 ? values.join(' + ') : ''
  history = pushRoll(history, values)
  renderHistory()
}

// Un tap n'importe où relance, sauf sur les commandes.
addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.ui')) return
  game.roll()
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-dice]')) {
  button.addEventListener('click', () => {
    const n = Number(button.dataset.dice)
    game.setCount(n)
    counter.textContent = String(n)
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-dice]')) {
      b.classList.toggle('is-active', b === button)
    }
  })
}

clearButton.addEventListener('click', () => {
  history = clearHistory()
  renderHistory()
})

if (shakeNeedsPermission()) {
  shakeButton.hidden = false
  shakeButton.addEventListener('click', async () => {
    if (await requestShakePermission()) {
      shakeButton.hidden = true
      listenForShake((force) => game.roll(force))
    } else {
      shakeButton.textContent = 'Secousse refusée'
    }
  })
} else {
  listenForShake((force) => game.roll(force))
}

renderHistory()
game.start().catch((error) => {
  total.textContent = '!'
  detail.textContent = 'Physique indisponible'
  console.error(error)
})
