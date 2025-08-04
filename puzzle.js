let crosswordsDb;
async function initCrosswordsDb() {
	crosswordsDb = await idb.openDB("crosswords", 1, {
		upgrade(db, oldVersion, newVersion, transaction, event) {
			const settingsStore = db.createObjectStore("settings", { keyPath: "id" });
			const puzzleStore = db.createObjectStore("puzzles", { keyPath: ["date", "source", "title"] });
			const playedPuzzlesStore = db.createObjectStore("playedPuzzles", { keyPath: ["date", "source", "title"] });
		},
		blocked(currentVersion, blockedVersion, event) {
			console.log("initCrosswordsDb - blocked");
		},
		blocking(currentVersion, blockedVersion, event) {
			console.log("initCrosswordsDb - blocking");
		},
		terminated() {
			console.log("initCrosswordsDb - terminated");
		},
	});
}

async function saveSettings(co) {
	await crosswordsDb.put("settings", co);
}

async function saveState(ps) {
	await crosswordsDb.put("playedPuzzles", ps);
}

async function getState(pd) {
	return await crosswordsDb.get("playedPuzzles", [pd.date, pd.source, pd.title]);
}

async function getPuzzle(puzzleKey) {
	return await crosswordsDb.get("puzzles", [puzzleKey.date, puzzleKey.source, puzzleKey.title]);
}

let defaultCrosswordOptions = {
	id: "me",
	showErrors: false,
	skipFilledCells: false,
	movementStyle: "stopAtEnd",
	useNativeKeyboard: false,
	puzzleScale: 1,
	puzzleKeyJson: ""
};

let currentPuzzle;
let defaultPuzzleState = {
	direction: "across", // across or down
	currentCellIndex: 0
}
let crosswordOptions;
let puzzleDefinition;
let puzzleState;
	
window.addEventListener("load", async function(e) {

	await initCrosswordsDb();
	crosswordOptions = await crosswordsDb.get("settings", "me");
	if (crosswordOptions === undefined || crosswordOptions === null) {
		crosswordOptions = structuredClone(defaultCrosswordOptions);
		saveSettings(crosswordOptions);
	} else {
		if (crosswordOptions.advanceToNextClueAtEndOfWord !== undefined) {
			crosswordOptions.movementStyle = "stopAtEnd";
			crosswordOptions.advanceToNextClueAtEndOfWord = undefined;
			if (crosswordOptions.puzzleKeyJson === undefined || crosswordOptions.puzzleKeyJson === null) {
				crosswordOptions.puzzleKeyJson = "";
			}
		}
	}

	const puzzleKeyJson = crosswordOptions.puzzleKeyJson;
	if (puzzleKeyJson !== undefined && puzzleKeyJson !== null && puzzleKeyJson.length > 0) {
		const puzzleKey = JSON.parse(puzzleKeyJson);
		puzzleDefinition = await getPuzzle(puzzleKey);
	}

	if (puzzleDefinition !== undefined && puzzleDefinition !== null) {
		puzzleDefinition.cells = Array.from(puzzleDefinition.cellContent);
		puzzleState = await getState(puzzleDefinition);
		if (puzzleState === undefined || puzzleState === null) {
			puzzleState = defaultPuzzleState;
			puzzleState.date = puzzleDefinition.date;
			puzzleState.source = puzzleDefinition.source;
			puzzleState.title = puzzleDefinition.title;
			if (puzzleState.cellGuesses === undefined || puzzleState.cellGuesses === null) {
				puzzleState.cellGuesses = puzzleDefinition.cells.map((x) => { return {
					"letter": (x !== "#" ? "" : x),
					"type": ""
					};});
			}
		}

		currentPuzzle = new Puzzle(puzzleDefinition, puzzleState);
		currentPuzzle.play();
	}
});
	
function Puzzle(definition, state) {
	let pd = definition;
	let ps = state;
	let currentCellEl;
	let focusInCellEl;
	let clueEl;
	
	this.play = function play() {
		displayPuzzle(createPuzzleGrid());
		let titleEl = document.querySelector("button[class='puzzle-title']");
		if (titleEl !== undefined && titleEl !== null) {
			titleEl.innerText = definition.title;
		}
		let puzzleGridEl = document.querySelector("div[class~='puzzle-grid']");
		clueEl = document.querySelector("div[class='puzzle-clue']");
		let cellIndex = ps.currentCellIndex;
		let initialFocusEl = puzzleGridEl.querySelector(`[cellindex="${cellIndex}"]`);
		if (initialFocusEl !== undefined && initialFocusEl !== null) {
			initialFocusEl.focus();
		}
	}
	
	let stateDebouncerId = 0;

	function updateState() {
		if (stateDebouncerId > 0) {
			clearTimeout(stateDebouncerId);
			stateDebouncerId = 0;
		}
		stateDebouncerId = setTimeout(async function() {
			await saveState(ps);
		}, 250);
	}
	
	function toggleDirection() {
		if (ps.direction === "across") {
			ps.direction = "down";
		} else {
			ps.direction = "across";
		}
		updateState();
	}
	
	function setCell(cellEl, letter, options) {
		let showError = false;
		cellEl.innerText = letter.toUpperCase();
		let cellIndex = parseInt(cellEl.getAttribute("cellindex"));

		// If a cell is being revealed, only show an error if the cell does not already have the correct letter.
		if (options?.reveal && ps.cellGuesses[cellIndex].letter !== pd.cells[cellIndex]) {
			showError = true;
		}

		ps.cellGuesses[cellIndex].letter = cellEl.innerText;

		if (crosswordOptions.showErrors) {
			if (ps.cellGuesses[cellIndex].letter !== "" && ps.cellGuesses[cellIndex].letter !== pd.cells[cellIndex]) {
				showError = true;
			}
		}

		if (showError) {
			ps.cellGuesses[cellIndex].type = "wrong";
			cellEl.setAttribute("guess", "wrong");
		}
		
		// Show errors may have been on so anything that is wrong and then fixed or cleared needs to be made waswrong.
		let guessType = cellEl.getAttribute("guess");
		if (guessType === "wrong" && (cellEl.innerText === "" || (ps.cellGuesses[cellIndex].letter === pd.cells[cellIndex]))) {
			ps.cellGuesses[cellIndex].type = "waswrong";
			cellEl.setAttribute("guess", "waswrong");
		}
			
		// Is the puzzle complete?
		let complete = true;
		for (let i = 0; i < pd.cells.length; i++) {
			if (pd.cells[i] !== ps.cellGuesses[i].letter) {
				complete = false;
				break;
			}
		}
		
		if (complete) {
			if (options !== undefined && options !== null) {
				options.puzzleComplete = true;
			}
			setTimeout(function() {
				// Yer done
				let dialogEl = document.querySelector("#puzzle-complete");
				if (dialogEl !== undefined && dialogEl !== null) {
					const initFn = dlgInitFunctions["puzzle-complete-init"];
					if (initFn !== undefined && initFn !== null) {
						initFn(dialogEl);
					}
					dialogEl.showModal();
				}
			}, 0);
		} else {
			updateState();
		}
	}
	
	function moveCell(test, increment, options) {
		let focusEl = document.querySelector("[class~='puzzle-cell-focus']");
		if (focusEl !== undefined && focusEl !== null) {
			let cellindex = parseInt(focusEl.getAttribute("cellindex"));
			let i = cellindex;
			while (test(i)) {
				if (pd.cells[i] === "#" && !(options?.hopBlocks)) {
					break;
				}
				i = increment(i);
				if  (pd.cells[i] !== "#") {
					break;
				}
			}
			if (i != cellindex) {
				cellEl = document.querySelector(`[cellindex="${i}"]`);
				if (cellEl !== undefined && cellEl !== null) {
					cellEl.focus();
				}
			}
		}
	}
	
	function moveRight(options) {
		moveCell((i) => (i % pd.columns < pd.columns -1), (i) => (i + 1), options);
	}
	
	function moveLeft(options) {
		moveCell((i) => (i % pd.columns > 0), (i) => (i - 1), options);
	}
	
	function moveUp(options) {
		moveCell((i) => (i > 0), (i) => (i - pd.rows), options);
	}
	
	function moveDown(options) {
		moveCell((i) => (Math.floor(i / pd.rows) < pd.rows), (i) => (i + pd.rows), options);
	}
	
	function moveNextCell(options) {
		if (ps.direction === "across") {
			moveRight(options);
		} else {
			moveDown(options);
		}
	}

	function movePreviousCell(options) {
		if (ps.direction === "across") {
			moveLeft(options);
		} else {
			moveUp(options);
		}
	}
	
	function getTargetAction(targetEl) {
		let action;
		while (targetEl !== undefined && targetEl !== null) {
			action = targetEl.getAttribute("action");
			if (action !== undefined && action !== null) {
				break;
			}
			targetEl = targetEl.parentElement;
		}
		return {targetEl: targetEl, action: action};
	}
	
	function reveal(action) {
		let cellList = [];
		const puzzleGridEl = document.querySelector("div[class~='puzzle-grid']");
		if (puzzleGridEl !== undefined && puzzleGridEl !== null) {
			if (action === "reveal-letter") {
				const el = puzzleGridEl.querySelector(".puzzle-cell-focus");
				if (el !== undefined && el !== null) {
					cellList.push(el);
				}
			} else if (action === "reveal-word") {
				const els = puzzleGridEl.querySelectorAll(".puzzle-cell-current-clue");
				if (els !== undefined && els !== null) {
					for (const el of els) {
						cellList.push(el);
					}
				}
			} else if (action === "reveal-puzzle") {
				const els = puzzleGridEl.querySelectorAll(".puzzle-cell:not(.puzzle-cell-block)");
				if (els !== undefined && els !== null) {
					for (const el of els) {
						cellList.push(el);
					}
				}
			}
			
			const options = {
				reveal: true,
				puzzleComplete: false
			};
			for (const el of cellList) {
				const cellIndex = parseInt(el.getAttribute("cellindex"));
				setCell(el, pd.cells[cellIndex], options);
				if (options.puzzleComplete) {
					break;
				}
			}
		}
	}
	
	document.addEventListener("keydown", function(e) {
		let focusEl = document.querySelector("[class~='puzzle-cell-focus']");
		if (focusEl !== undefined && focusEl !== null) {
			let doDefault = true;
			const revealPopoverStyle = window.getComputedStyle(popoverEl);
			if (revealPopoverStyle.display === "none") {
				if (/^[a-z]$/i.test(e.key)) {
					setCell(focusEl, e.key.toUpperCase());
					moveNextCell();
				} else if (e.key === " ") {
					let targetEl;
					let action;
					({ targetEl: targetEl, action: action } = getTargetAction(e.target));
					if (action === undefined || action == null) {
						toggleDirection();
						updateCurrentClue();
						doDefault = false;
					}
				} else if (e.keyCode === 8) {
					if (focusEl.innerText === "") {
						movePreviousCell();
						focusEl = document.querySelector("[class~='puzzle-cell-focus']");
						if (focusEl === undefined || focusEl === null) {
							return;
						}
					}
					setCell(focusEl, "");
				} else if (e.keyCode === 40) { // down
					moveDown({hopBlocks: true});
					doDefault = false;
				} else if (e.keyCode === 38) { // up
					moveUp({hopBlocks: true});
					doDefault = false;
				} else if (e.keyCode === 37) { // left
					moveLeft({hopBlocks: true});
					doDefault = false;
				} else if (e.keyCode === 39) { // right
					moveRight({hopBlocks: true});
					doDefault = false;
				} else if (e.key === ".") {
					showRevealMenu(currentCellEl);
					doDefault = false;
				} else if (e.key === "?") {
					showHelp();
					doDefault = false;
				}
			} else {
				// In the reveal menu
				if (e.keyCode === 40) { // down
					let focusEl = popoverEl.querySelector("li:focus");
					if (focusEl !== undefined && focusEl !== null && focusEl.nextElementSibling === null) {
						focusEl = popoverEl.querySelector("li");
					} else {
						focusEl = focusEl.nextElementSibling;
					}
					focusEl.focus();
					doDefault = false;
				} else if (e.keyCode === 38) { // up
					let focusEl = popoverEl.querySelector("li:focus");
					if (focusEl !== undefined && focusEl !== null && focusEl.previousElementSibling === null) {
						focusEl = popoverEl.querySelector("li:last-child");
					} else {
						focusEl = focusEl.previousElementSibling;
					}
					focusEl.focus();
					doDefault = false;
				} else if (e.key === " ") {
					popoverEl.hidePopover();
					reveal(getTargetAction(e.target));
				}
			}

			if (!doDefault) {
				e.preventDefault();
				e.cancelBubble = true;
				e.stopPropagation();
			}
		}
	});
	
	function isCell(el, pd) {
		if (el !== undefined && el !== null && el.classList.contains("puzzle-cell")) {
			let cellindex = parseInt(el.getAttribute("cellindex"));
			if (pd.cells[cellindex] !== "#") {
				return true;
			}
		}
		return false;
	}
	
	function isKey(el) {
		if (el.classList.contains("puzzle-keyboard-key")) {
			return true;
		} else if (el.parentElement.classList.contains("puzzle-keyboard-key")) {
			return true;
		}
		return false;
	}
	
//var tempEl = document.createElement("div");
//tempEl.innerHTML = '<input type="text" name="letterEnter" autocomplete="off" inputmode="text" class="puzzle-input"/>';
//var inputEl = tempEl.firstChild;
//document.lastChild.appendChild(inputEl);
	document.addEventListener("focusin", function(e) {
		if (isCell(e.target, puzzleDefinition)) {
			let focusEl = document.querySelector("[class~='puzzle-cell-focus']");
			if (focusEl !== undefined && focusEl !== null) {
				focusEl.classList.remove("puzzle-cell-focus");
			}
			e.target.classList.add("puzzle-cell-focus");
			focusInCellEl = e.target;
			currentCellEl = e.target;
			updateCurrentClue();
		}
	});
	
	const dlgInitFunctions = {
		"puzzle-settings-init": function (dialogEl) {
			if (!dialogEl.inited) {
				dialogEl.inited = true;
				dialogEl.updateShowErrorsIcon = function updateShowErrorsIcon(el) {
					if (el.dataset.propName === "showErrors") {
						if (crosswordOptions[el.dataset.propName]) {
							el.parentElement.nextSibling.setAttribute("guess", "waswrong");
						} else {
							el.parentElement.nextElementSibling.removeAttribute("guess");
						}
					}
				};
				dialogEl.addEventListener("click", function(e) {
					if (e.target.dataset.propName !== undefined && e.target.dataset.propName !== null) {
						if (e.target.dataset.propName === "showErrors" || e.target.dataset.propName === "skipFilledCells") {
							crosswordOptions[e.target.dataset.propName] = e.target.checked;
						} else {
							crosswordOptions[e.target.dataset.propName] = e.target.value;
						}
						saveSettings(crosswordOptions);
						dialogEl.updateShowErrorsIcon(e.target);
						
						// Show errors for non-empty cells.
						if (e.target.dataset.propName === "showErrors" && crosswordOptions.showErrors) {
							for (let i = 0; i < pd.cells.length; i++) {
								if (ps.cellGuesses[i].letter !== "" && pd.cells[i] !== ps.cellGuesses[i].letter) {
									ps.cellGuesses[i].type = "wrong";
									const cellEl = document.querySelector(`[cellindex="${i}"]`);
									if (cellEl !== undefined && cellEl !== null) {
										cellEl.setAttribute("guess", "wrong");
									}
								}
							}
						}
					}
				});
				let checkEl = dialogEl.querySelector("#ShowErrors");
				checkEl.checked = crosswordOptions.showErrors;
				dialogEl.updateShowErrorsIcon(checkEl);
				checkEl = dialogEl.querySelector("#MovementStyle");
				checkEl.value = crosswordOptions.movementStyle;
				checkEl = dialogEl.querySelector("#SkipFilled");
				checkEl.checked = crosswordOptions.skipFilledCells;
			}
		},

		"puzzle-info-init": function(dialogEl) {
			if (!dialogEl.inited) {
				dialogEl.inited = true;
				const infoType = ["source", "title", "author", "copyright", "notes", "trustedNotes"];
				let el;
				for (const type of infoType) {
					el = dialogEl.querySelector(`info-${type}`);
					if (el !== undefined && el !== null) {
						let text = puzzleDefinition[type];
						if (text !== undefined && text !== null && text !== "") {
							if (type === "trustedNotes") {
								el.innerHTML = text;
							} else {
								el.innerText = text;
							}
						} else {
							el.style.display = "none";
						}
					}
				}
			}
		},

		"puzzle-complete-init": function(dialogEl) {
			if (!dialogEl.inited) {
				dialogEl.inited = true;
				const totalBoxes = puzzleState.cellGuesses.reduce((acc, g) => acc + (g.letter !== "#" ? 1 : 0), 0);
				const hintedBoxes = puzzleState.cellGuesses.reduce((acc, g) => acc + (g.type !== "" ? 1 : 0), 0);
				let totalClues = puzzleDefinition.clues["across"].reduce((acc, clue) => acc + (clue !== "" ? 1 : 0), 0);
				totalClues = puzzleDefinition.clues["down"].reduce((acc, clue) => acc + (clue !== "" ? 1 : 0), totalClues);
				const attributes = [{
					"name": "complete-time", 
					"fn": function() {
						return `Completed in `;
					}
				}, {
					"name": "total-clues",
					"fn": function() {
						return `Total clues ${totalClues}`;
					}
				}, {
					"name": "total-boxes", 
					"fn": function(pd, ps) {
						return `Total boxes ${totalBoxes}`;
					}
				}, {
					"name": "hinted-boxes",
					"fn": function() {
						return `Hinted boxes ${hintedBoxes} (${Math.floor((hintedBoxes / totalBoxes) * 100.0)}%)`;
					}
			 	}];
				let el;
				for (const attr of attributes) {
					el = dialogEl.querySelector(`div[${attr.name}]`);
					if (el !== undefined && el !== null) {
						let text = attr.fn();
						if (text !== undefined && text !== null && text !== "") {
							el.innerText = text;
						} else {
							el.style.display = "none";
						}
					}
				}
			}
		}
	};

	const popoverEl = document.querySelector("#revealpopover");
	popoverEl.addEventListener("toggle", function(e) {
		if (e.newState === 'open') {
			const firstItem = popoverEl.querySelector("li");
			if (firstItem !== undefined && firstItem !== null) {
				firstItem.focus();
			}
		}
	});
	
	function showRevealMenu(cellEl) {
		const viewPortRect = document.documentElement.getBoundingClientRect();
		const cellRect = cellEl.getBoundingClientRect()
		popoverEl.classList.add("for-sizing");
		const popoverRect = popoverEl.getBoundingClientRect();

		let top = cellRect.top;
		let left = cellRect.left;
		let xSign = "-";
		let ySign = "-";
		if (left < 0) {
			left = 0;
			xSign = "+";
		} else if (left + popoverRect.width > viewPortRect.width) {
			left = viewPortRect.width - popoverRect.width;
			xSign = "-";
		}
		if (top < 0) {
			top = 0;
			xSign = "+";
		} else if (top + popoverRect.height > viewPortRect.height) {
			top = viewPortRect.height - popoverRect.height;
			ySign = "-";
		}
		popoverEl.classList.remove("for-sizing");
		popoverEl.style.setProperty("top", `calc(${top}px ${ySign} 0.5rem)`);
		popoverEl.style.setProperty("left", `calc(${left}px ${xSign} 0.5rem)`);
		popoverEl.showPopover();
	}

	function showHelp() {
		let dialogEl = document.querySelector("#puzzle-help");
		if (dialogEl !== undefined && dialogEl !== null) {
			const initFn = dlgInitFunctions["puzzle-help-init"];
			if (initFn !== undefined && initFn !== null) {
				initFn(dialogEl);
			}
			dialogEl.showModal();
		}
	}

	document.addEventListener("contextmenu", function(e) {
		if (isCell(e.target, puzzleDefinition)) {
			e.preventDefault();
			e.cancelBubble = true;
			e.stopPropagation();
			showRevealMenu(e.target);
		}
	});

	document.addEventListener("transitionend", function(e) {
		if (e.target.classList.contains("puzzle-keyboard-key")) {
			e.target.removeAttribute("pressed");
		}
	});
	
	document.addEventListener("click", function(e) {
		if (isCell(e.target, puzzleDefinition)) {
			if (focusInCellEl === e.target) {
				focusInCellEl = undefined;
				return;
			}
			if (currentCellEl === e.target) {
				toggleDirection();
				updateCurrentClue();
			} else {
				e.target.focus();
			}
		} else if (isKey(e.target)) {
			let focusEl = document.querySelector("[class~='puzzle-cell-focus']");
			if (focusEl !== undefined && focusEl !== null) {
				let key = e.target.getAttribute("key-action");
				if (key === undefined || key === null) {
					key = e.target.parentElement.getAttribute("key-action");
				}
				if (key === "_") {
					toggleDirection();
					updateCurrentClue();
				} else if (key === ".") {
					showRevealMenu(currentCellEl);
				} else if (key === "?") {
					showHelp();
				} else if (key === "bs") {
					if (focusEl.innerText === "") {
						movePreviousCell();
						focusEl = document.querySelector("[class~='puzzle-cell-focus']");
						if (focusEl === undefined || focusEl === null) {
							return;
						}
					}
					setCell(focusEl, "");
				} else if (/^[a-z]$/i.test(key)) {
					e.target.setAttribute("pressed", "");
					setCell(focusEl, key.toUpperCase());
					moveNextCell();
				}
			}
		} else {
			let targetEl;
			let action;
			({ targetEl: targetEl, action: action } = getTargetAction(e.target));
			if (action !== null && action !== undefined) {
				let m = /^show-dialog-(?<button>.*)$/.exec(action);
				if (m !== undefined && m !== null) {
					const dlgName = m.groups["button"];
					let dialogEl = document.querySelector("#"+dlgName);
					if (dialogEl !== undefined && dialogEl !== null) {
						const initFn = dlgInitFunctions[dlgName+"-init"];
						if (initFn !== undefined && initFn !== null) {
							initFn(dialogEl);
						}
						dialogEl.showModal();
					}
				} else if (action === "close-dlg") {
					let dialogEl = targetEl;
					while (dialogEl !== undefined && dialogEl !== null) {
						if (dialogEl.nodeName === "DIALOG") {
							dialogEl.close();
							break;
						}
						dialogEl = dialogEl.parentElement;
					}
				} else if (action === "return-to-puzzle-list") {
					history.back();
				} else if (/^reveal-/i.test(action)) {
					popoverEl.hidePopover();
					reveal(action);
				}
			}
		}
	});

	function getClueNumber(cellEl) {
		let clueNumber = 0;
		if (cellEl !== undefined && cellEl !== null) {
			let cn = cellEl.getAttribute("cluenumber");
			if (cn !== undefined && cn !== null) {
				clueNumber = parseInt(cn);
				if (clueNumber === Number.NaN) {
					clueNumber = 0;
				}
			}
		}
		return clueNumber;
	}
	
	function updateCurrentClue() {
		let clearCells = document.querySelectorAll("[class~='puzzle-cell-current-clue']");
		let highlightCells = [];
		if (currentCellEl !== undefined && currentCellEl !== null) {
			let cellindex = parseInt(currentCellEl.getAttribute("cellindex"));
			let i
			let cellEl;
			let clueNumber = 0;
			
			if (ps.currentCellIndex !== cellindex) {
				ps.currentCellIndex = cellindex;
				updateState();
			}

			if (ps.direction === "across") {
				let rowStartIndex = cellindex - Math.floor(cellindex % pd.columns);
				for (i = cellindex; i >= rowStartIndex; i--) {
					if (pd.cells[i] === "#") {
						break;
					}
					cellEl = document.querySelector(`[cellindex="${i}"]`);
					if (cellEl !== undefined && cellEl !== null) {
						highlightCells.push(cellEl);
						clueNumber = getClueNumber(cellEl);
					}
				}
				let rowEndIndex = rowStartIndex + pd.columns;
				for (i = cellindex + 1; i < rowEndIndex; i++) {
					if (pd.cells[i] === "#") {
						break;
					}
					cellEl = document.querySelector(`[cellindex="${i}"]`);
					if (cellEl !== undefined && cellEl !== null) {
						highlightCells.push(cellEl);
					}
				}
			} else {
				let colStartIndex = Math.floor(cellindex % pd.rows);
				for (i = cellindex; i >= colStartIndex; i = i - pd.rows) {
					if (pd.cells[i] === "#") {
						break;
					}
					cellEl = document.querySelector(`[cellindex="${i}"]`);
					if (cellEl !== undefined && cellEl !== null) {
						highlightCells.push(cellEl);
						clueNumber = getClueNumber(cellEl);
					}
				}
				let colEndIndex = ((pd.columns * pd.rows) - pd.columns) + colStartIndex + 1;
				for (i = cellindex + pd.columns; i < colEndIndex; i = i + pd.columns) {
					if (pd.cells[i] === "#") {
						break;
					}
					cellEl = document.querySelector(`[cellindex="${i}"]`);
					if (cellEl !== undefined && cellEl !== null) {
						highlightCells.push(cellEl);
					}
				}
			}
			
			if (clueNumber !== 0 && clueNumber !== ps.currentClueNumber) {
				if (clueEl !== undefined && clueEl !== null) {
					let directionText = ps.direction;
					let clue = pd.clues[ps.direction][clueNumber];
					clueEl.innerText = `(${directionText}) ${clueNumber}. ${clue}`;
				}
			}
		}
		
		if (clearCells !== undefined && clearCells !== null) {
			// If a cell to be hightlighted already is highlighted remove it from
			// the list to
			let cells = Array.from(clearCells);
			let difference = cells.filter(cell => !highlightCells.includes(cell));
			for (const el of difference) {
				el.classList.remove("puzzle-cell-current-clue");
			}
		}
		if (highlightCells.length > 0) {
			for (const el of highlightCells) {
				if (!el.classList.contains("puzzle-cell-current-clue")) {
					el.classList.add("puzzle-cell-current-clue");
				}
			}
		}
	}
	
	function createPuzzleGrid() {
		let puzzleHtml = "";

		let cellNumber = 0;
		for (let cellIndex = 0; cellIndex < pd.columns * pd.rows; cellIndex++) {
			let clueNumber = "";
			if (pd.cells[cellIndex] != "#") {
				let row = Math.floor(cellIndex / pd.columns);
				let col = Math.floor(cellIndex % pd.rows);
				if (row == 0 || col == 0) {
					cellNumber = cellNumber + 1;
					clueNumber = "" + cellNumber;
				} else if (cellIndex > 0 && pd.cells[cellIndex -1] == "#" ||
						   cellIndex > pd.columns && pd.cells[cellIndex - pd.columns] == "#") {
					cellNumber = cellNumber + 1;
					clueNumber = "" + cellNumber;
				}
			}
			let moreClass = "";
			let tabIndex = 'tabindex="0"';
			if (pd.cells[cellIndex] === "#") {
				moreClass = "puzzle-cell-block";
				tabIndex = "";
			}
			let letter = puzzleState.cellGuesses[cellIndex].letter;
			let guess = puzzleState.cellGuesses[cellIndex].type;
			puzzleHtml += `<div class="puzzle-cell ${moreClass}" ${tabIndex} cellindex="${cellIndex}" cluenumber="${clueNumber}" guess="${guess}">${letter}</div>`
		}
		return puzzleHtml;
	}
	
	function displayPuzzle(puzzleHtml) {
		let puzzleEl = document.querySelector("div.puzzle-grid");
		if (puzzleEl !== undefined && puzzleEl !== null) {
			puzzleEl.style.setProperty("--puzzle-size", "" + pd.columns);
			puzzleEl.innerHTML = puzzleHtml;
		}
	}
}
